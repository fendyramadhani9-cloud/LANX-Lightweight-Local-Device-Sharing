package transfer

import (
	"path/filepath"
	"testing"
)

func TestMailboxOperations(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "mailbox.json")

	mb := NewMailbox(dbPath)

	// Add file for offline PC Guru
	item1 := mb.AddFile("tf-1", "dl-1", "Tugas_Matematika.zip", 10240, "pc-guru", "siswa-1", "Ahmad")
	if item1.ID == "" {
		t.Fatal("expected non-empty mailbox item ID")
	}

	// Add text for offline PC Guru
	item2 := mb.AddText("Pak ini tugas saya sudah saya kumpulkan", "pc-guru", "siswa-1", "Ahmad")
	if item2.ID == "" {
		t.Fatal("expected non-empty mailbox item ID")
	}

	// Add file for another device
	_ = mb.AddFile("tf-2", "dl-2", "foto.jpg", 2048, "pc-lain", "siswa-2", "Budi")

	// Verify pending count for PC Guru
	if count := mb.CountPendingForDevice("pc-guru"); count != 2 {
		t.Fatalf("expected 2 pending items for pc-guru, got %d", count)
	}

	pending := mb.GetPendingForDevice("pc-guru")
	if len(pending) != 2 {
		t.Fatalf("expected 2 items in slice, got %d", len(pending))
	}
	if pending[0].Filename != "Tugas_Matematika.zip" {
		t.Errorf("expected Tugas_Matematika.zip, got %s", pending[0].Filename)
	}
	if pending[1].TextContent != "Pak ini tugas saya sudah saya kumpulkan" {
		t.Errorf("expected text content match, got %s", pending[1].TextContent)
	}

	// Mark item1 delivered
	if ok := mb.MarkDelivered(item1.ID); !ok {
		t.Fatal("expected MarkDelivered to succeed")
	}

	if count := mb.CountPendingForDevice("pc-guru"); count != 1 {
		t.Fatalf("expected 1 pending item after delivery, got %d", count)
	}

	// Verify persistence by loading new Mailbox instance from same dbPath
	mb2 := NewMailbox(dbPath)
	pending2 := mb2.GetPendingForDevice("pc-guru")
	if len(pending2) != 1 {
		t.Fatalf("expected 1 pending item in reloaded mailbox, got %d", len(pending2))
	}
	if pending2[0].ID != item2.ID {
		t.Errorf("expected item2 ID in reloaded mailbox, got %s", pending2[0].ID)
	}

	// Clean delivered items
	cleaned := mb2.CleanDelivered(0)
	if cleaned != 1 {
		t.Errorf("expected 1 cleaned item, got %d", cleaned)
	}
}
