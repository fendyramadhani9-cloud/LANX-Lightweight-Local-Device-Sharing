//go:build windows

package transfer

import (
	"syscall"
	"unsafe"
)

// DiskUsage holds server host disk capacity statistics.
type DiskUsage struct {
	TotalBytes uint64  `json:"total_bytes"`
	FreeBytes  uint64  `json:"free_bytes"`
	UsedBytes  uint64  `json:"used_bytes"`
	Percentage float64 `json:"percentage"`
}

func getDiskSpace(path string) (*DiskUsage, error) {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	getDiskFreeSpaceEx := kernel32.NewProc("GetDiskFreeSpaceExW")

	var freeBytesAvailable, totalNumberOfBytes, totalNumberOfFreeBytes int64
	pathPtr, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	r1, _, err := getDiskFreeSpaceEx.Call(
		uintptr(unsafe.Pointer(pathPtr)),
		uintptr(unsafe.Pointer(&freeBytesAvailable)),
		uintptr(unsafe.Pointer(&totalNumberOfBytes)),
		uintptr(unsafe.Pointer(&totalNumberOfFreeBytes)),
	)
	if r1 == 0 {
		return nil, err
	}

	total := uint64(totalNumberOfBytes)
	free := uint64(freeBytesAvailable)
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
