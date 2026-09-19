FROM golang:1.23-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o lanx ./cmd/lanx

FROM alpine:latest
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
WORKDIR /app
COPY --from=builder /app/lanx .
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/app/lanx"]
CMD ["--port", "8080", "--data", "/data"]
