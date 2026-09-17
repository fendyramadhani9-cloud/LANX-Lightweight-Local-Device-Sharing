package server

import (
	"bufio"
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"time"

	"github.com/fendy/lanx/internal/config"
)

//go:embed all:static
var webFS embed.FS

// Server is the main LANX HTTP server.
type Server struct {
	cfg    *config.Config
	mux    *http.ServeMux
	srv    *http.Server
	logger *log.Logger
}

// New creates a new Server instance.
func New(cfg *config.Config, logger *log.Logger) *Server {
	s := &Server{
		cfg:    cfg,
		mux:    http.NewServeMux(),
		logger: logger,
	}
	s.registerRoutes()
	return s
}

// Start begins listening on the configured port.
func (s *Server) Start(ctx context.Context) error {
	addr := fmt.Sprintf(":%d", s.cfg.Port)
	s.srv = &http.Server{
		Addr:              addr,
		Handler:           s.withMiddleware(s.mux),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1 MB
	}

	// Print startup info
	s.printBanner()

	errCh := make(chan error, 1)
	go func() {
		if err := s.srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return s.srv.Shutdown(shutCtx)
	}
}

// Mux returns the underlying ServeMux for external route registration.
func (s *Server) Mux() *http.ServeMux {
	return s.mux
}

func (s *Server) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Request logging
		start := time.Now()
		lrw := &loggingResponseWriter{ResponseWriter: w, statusCode: 200}
		next.ServeHTTP(lrw, r)
		s.logger.Printf("%s %s %d %s", r.Method, r.URL.Path, lrw.statusCode, time.Since(start).Round(time.Millisecond))
	})
}

func (s *Server) printBanner() {
	ip := getLocalIP()
	fmt.Println()
	fmt.Println("  \033[1mLANX\033[0m")
	fmt.Println()
	fmt.Println("  Local sharing server started")
	fmt.Println()
	fmt.Printf("  Local:\n")
	fmt.Printf("  \033[36mhttp://%s:%d\033[0m\n", ip, s.cfg.Port)
	fmt.Println()
	fmt.Printf("  Device: %s\n", s.cfg.DeviceName)
	fmt.Println()
	fmt.Println("  Waiting for devices...")
	fmt.Println()
}

func getLocalIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return "127.0.0.1"
	}
	for _, addr := range addrs {
		if ipNet, ok := addr.(*net.IPNet); ok && !ipNet.IP.IsLoopback() {
			if ipNet.IP.To4() != nil {
				return ipNet.IP.String()
			}
		}
	}
	return "127.0.0.1"
}

// GetLocalIP exports local IP for use by other packages.
func GetLocalIP() string {
	return getLocalIP()
}

type loggingResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (lrw *loggingResponseWriter) WriteHeader(code int) {
	lrw.statusCode = code
	lrw.ResponseWriter.WriteHeader(code)
}

// Hijack implements http.Hijacker for WebSocket support.
func (lrw *loggingResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := lrw.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, fmt.Errorf("ResponseWriter does not implement http.Hijacker")
}

// Flush implements http.Flusher for streaming responses.
func (lrw *loggingResponseWriter) Flush() {
	if f, ok := lrw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// StaticFS returns the embedded web filesystem for use in route registration.
func StaticFS() fs.FS {
	sub, err := fs.Sub(webFS, "static")
	if err != nil {
		panic("embedded static fs: " + err.Error())
	}
	return sub
}
