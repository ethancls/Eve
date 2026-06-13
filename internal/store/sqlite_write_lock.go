package store

import "sync"

var sqliteWriteMu sync.Mutex

func lockSQLiteWrite() func() {
	sqliteWriteMu.Lock()
	return sqliteWriteMu.Unlock
}
