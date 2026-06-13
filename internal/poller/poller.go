package poller

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/user/eve/internal/docker"
	"github.com/user/eve/internal/store"
)

type BroadcastFn func([]map[string]any)

type Poller struct {
	mp        *docker.Client
	metrics   *store.MetricsStore
	interval  time.Duration
	broadcast BroadcastFn
	logger    *slog.Logger
}

func New(mp *docker.Client, metrics *store.MetricsStore, interval time.Duration, broadcast BroadcastFn, logger *slog.Logger) *Poller {
	return &Poller{
		mp:        mp,
		metrics:   metrics,
		interval:  interval,
		broadcast: broadcast,
		logger:    logger,
	}
}

func (p *Poller) Run(ctx context.Context) {
	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			containers, err := p.mp.ListContainers(ctx)
			if err != nil {
				p.logger.Error("poller failed to list containers", "error", err)
				continue
			}

			var statsData []map[string]any
			for _, c := range containers {
				if c.State != "running" {
					continue
				}
				name := c.ID
				if len(c.Names) > 0 {
					name = c.Names[0][1:] // strip leading slash
				}

				statsReader, err := p.mp.ContainerStats(ctx, c.ID, false)
				if err != nil {
					continue
				}
				
				var v map[string]any
				if err := json.NewDecoder(statsReader).Decode(&v); err == nil {
					memStats, _ := v["memory_stats"].(map[string]any)
					cpuStats, _ := v["cpu_stats"].(map[string]any)
					preCpuStats, _ := v["precpu_stats"].(map[string]any)

					var memUsed, memTotal float64
					if memStats != nil {
						memUsed, _ = memStats["usage"].(float64)
						memTotal, _ = memStats["limit"].(float64)
					}

					var cpuPercent float64
					if cpuStats != nil && preCpuStats != nil {
						cpuUsage, _ := cpuStats["cpu_usage"].(map[string]any)
						preCpuUsage, _ := preCpuStats["cpu_usage"].(map[string]any)
						
						if cpuUsage != nil && preCpuUsage != nil {
							totalUsage, _ := cpuUsage["total_usage"].(float64)
							preTotalUsage, _ := preCpuUsage["total_usage"].(float64)
							systemUsage, _ := cpuStats["system_cpu_usage"].(float64)
							preSystemUsage, _ := preCpuStats["system_cpu_usage"].(float64)

							cpuDelta := totalUsage - preTotalUsage
							systemDelta := systemUsage - preSystemUsage

							if systemDelta > 0 && cpuDelta > 0 {
								cpuPercent = (cpuDelta / systemDelta) * 100.0
								// Multiply by number of CPUs if available
								if onlineCPUs, ok := cpuStats["online_cpus"].(float64); ok {
									cpuPercent *= onlineCPUs
								}
							}
						}
					}

					statsData = append(statsData, map[string]any{
						"name": name,
						"cpu": cpuPercent,
						"ram_used": memUsed,
						"disk_used": 0,
						"memory": map[string]any{
							"used": memUsed,
							"total": memTotal,
						},
					})
				}
				statsReader.Close()
			}
			
			if len(statsData) > 0 {
				p.metrics.AppendInstances(statsData)
				if p.broadcast != nil {
					p.broadcast(statsData)
				}
			}
		}
	}
}
