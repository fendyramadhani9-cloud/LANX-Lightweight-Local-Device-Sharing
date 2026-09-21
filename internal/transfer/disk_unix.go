//go:build !windows

package transfer

import (
	"syscall"
)

// DiskUsage holds server host disk capacity statistics.
type DiskUsage struct {
	TotalBytes uint64  `json:"total_bytes"`
	FreeBytes  uint64  `json:"free_bytes"`
	UsedBytes  uint64  `json:"used_bytes"`
	Percentage float64 `json:"percentage"`
}

func getDiskSpace(path string) (*DiskUsage, error) {
	var stat syscall.Statfs_t
	err := syscall.Statfs(path, &stat)
	if err != nil {
		return nil, err
	}

	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bavail * uint64(stat.Bsize)
	used := uint64(0)
	if total > free {
		used = total - free
	}

	pct := 0.0
	if total > 0 {
		pct = (float64(used) / float64(total)) * 100.0
	}

	return &DiskUsage{
		TotalBytes: total,
		FreeBytes:  free,
		UsedBytes:  used,
		Percentage: pct,
	}, nil
}
