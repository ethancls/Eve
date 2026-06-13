FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM golang:1.24-alpine AS backend-builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
RUN CGO_ENABLED=0 GOOS=linux go build -o eve main.go

FROM alpine:latest
RUN apk --no-cache add ca-certificates docker-cli docker-cli-compose
WORKDIR /app
COPY --from=backend-builder /app/eve .
EXPOSE 8100
ENV EVE_BIND="0.0.0.0:8100"
ENV DOCKER_HOST="unix:///var/run/docker.sock"
ENTRYPOINT ["/app/eve"]
