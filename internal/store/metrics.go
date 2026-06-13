package store

import (
	"sync"
	"time"
)

const defaultMaxPoints = 60

// MetricPoint holds a single resource usage snapshot.
type MetricPoint struct {
	TS        string `json:"ts"`
	CPU       float64 `json:"cpu"`
	RAMUsed   int64  `json:"ram_used"`
	RAMTotal  int64  `json:"ram_total"`
	DiskUsed  int64  `json:"disk_used"`
	DiskTotal int64  `json:"disk_total"`
}

// ringBuffer is a fixed-size circular buffer.
type ringBuffer struct {
	buf  []MetricPoint
	head int // next write position
	size int // current fill
	cap  int
}

func newRingBuffer(capacity int) *ringBuffer {
	return &ringBuffer{buf: make([]MetricPoint, capacity), cap: capacity}
}

func (r *ringBuffer) push(p MetricPoint) {
	r.buf[r.head] = p
	r.head = (r.head + 1) % r.cap
	if r.size < r.cap {
		r.size++
	}
}

func (r *ringBuffer) slice() []MetricPoint {
	if r.size == 0 {
		return nil
	}
	out := make([]MetricPoint, r.size)
	start := (r.head - r.size + r.cap) % r.cap
	for i := 0; i < r.size; i++ {
		out[i] = r.buf[(start+i)%r.cap]
	}
	return out
}

// MetricsStore holds in-memory metric history for all VMs.
type MetricsStore struct {
	mu        sync.RWMutex
	history   map[string]*ringBuffer
	maxPoints int
}

// NewMetricsStore creates a new in-memory metrics store.
func NewMetricsStore(maxPoints int) *MetricsStore {
	if maxPoints < 5 {
		maxPoints = defaultMaxPoints
	}
	return &MetricsStore{
		history:   make(map[string]*ringBuffer),
		maxPoints: maxPoints,
	}
}

// AppendInstances ingests a fresh snapshot of all instances.
func (s *MetricsStore) AppendInstances(instances []map[string]any) {
	ts := time.Now().UTC().Format(time.RFC3339Nano)

	s.mu.Lock()
	defer s.mu.Unlock()

	active := make(map[string]bool, len(instances))
	for _, inst := range instances {
		name, _ := inst["name"].(string)
		if name == "" {
			continue
		}
		active[name] = true

		mem, _ := inst["memory"].(map[string]any)
		if mem == nil {
			mem = map[string]any{}
		}
		disk, _ := inst["disk"].(map[string]any)
		if disk == nil {
			disk = map[string]any{}
		}

		p := MetricPoint{
			TS:        ts,
			CPU:       toFloat64Metric(inst["cpu"]),
			RAMUsed:   toInt64Metric(mem["used"]),
			RAMTotal:  toInt64Metric(mem["total"]),
			DiskUsed:  toInt64Metric(disk["used"]),
			DiskTotal: toInt64Metric(disk["total"]),
		}

		rb, ok := s.history[name]
		if !ok {
			rb = newRingBuffer(s.maxPoints)
			s.history[name] = rb
		}
		rb.push(p)
	}

	// Keep history for stopped containers - don't delete stale entries
}

// Get returns the metric history for a VM.
func (s *MetricsStore) Get(vmName string) []MetricPoint {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rb, ok := s.history[vmName]
	if !ok {
		return nil
	}
	return rb.slice()
}

func toFloat64Metric(v any) float64 {
	if v == nil {
		return 0
	}
	switch n := v.(type) {
	case float64:
		return n
	case int64:
		return float64(n)
	case int:
		return float64(n)
	}
	return 0
}

func toInt64Metric(v any) int64 {
	if v == nil {
		return 0
	}
	switch n := v.(type) {
	case int64:
		return n
	case float64:
		return int64(n)
	case int:
		return int64(n)
	}
	return 0
}
