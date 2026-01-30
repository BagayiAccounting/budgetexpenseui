# Docker Deployment Guide

This guide explains how to deploy the Budget Expense UI application using Docker in a production environment.

## Prerequisites

- Docker (version 20.10 or higher)
- Docker Compose (version 2.0 or higher)
- Access to SurrealDB at `https://api.bagayi.com`
- Auth0 account with configured application

## Quick Start

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd budget-expense-ui
```

### 2. Configure Environment Variables

Create a `.env.production` file from the example:

```bash
cp .env.production.example .env.production
```

Edit `.env.production` and update the following variables:

```bash
# Generate a random 32-character string for AUTH0_SECRET
AUTH0_SECRET=your_random_32_character_string

# Your production domain
AUTH0_BASE_URL=https://your-production-domain.com

# Auth0 credentials from your Auth0 dashboard
AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com
AUTH0_CLIENT_ID=your_auth0_client_id
AUTH0_CLIENT_SECRET=your_auth0_client_secret
AUTH0_AUDIENCE=https://your-api-identifier
```

**Generate AUTH0_SECRET:**
```bash
openssl rand -base64 32
```

### 3. Build and Run with Docker Compose

```bash
# Build and start the application
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the application
docker-compose down
```

The application will be available at `http://localhost:3000`

## Manual Docker Build

If you prefer to build and run without Docker Compose:

### Build the Image

```bash
docker build -t budget-expense-ui:latest .
```

### Run the Container

```bash
docker run -d \
  --name budget-expense-ui \
  -p 3000:3000 \
  --env-file .env.production \
  budget-expense-ui:latest
```

### View Logs

```bash
docker logs -f budget-expense-ui
```

### Stop the Container

```bash
docker stop budget-expense-ui
docker rm budget-expense-ui
```

## Production Deployment

### Using a Reverse Proxy (Recommended)

In production, use a reverse proxy like Nginx or Traefik to handle HTTPS:

#### Nginx Example

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    # SSL configuration
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # Proxy to Docker container
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Environment Variables Reference

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `NODE_ENV` | Yes | Node environment | `production` |
| `PORT` | No | Application port | `3000` |
| `SURREAL_BASE_URL` | Yes | SurrealDB API URL | `https://api.bagayi.com` |
| `AUTH0_SECRET` | Yes | Auth0 session secret | - |
| `AUTH0_BASE_URL` | Yes | Your app's public URL | - |
| `AUTH0_ISSUER_BASE_URL` | Yes | Auth0 tenant URL | - |
| `AUTH0_CLIENT_ID` | Yes | Auth0 client ID | - |
| `AUTH0_CLIENT_SECRET` | Yes | Auth0 client secret | - |
| `AUTH0_AUDIENCE` | No | Auth0 API audience | - |
| `AUTH0_SCOPE` | No | Auth0 scopes | `openid profile email` |

## Health Checks

The application includes built-in health checks:

```bash
# Check if container is healthy
docker inspect --format='{{.State.Health.Status}}' budget-expense-ui

# Manual health check
curl http://localhost:3000/api/health
```

## Monitoring

### View Real-time Logs

```bash
docker-compose logs -f budget-expense-ui
```

### Check Resource Usage

```bash
docker stats budget-expense-ui
```

### Container Status

```bash
docker ps -a | grep budget-expense-ui
```

## Troubleshooting

### Container Won't Start

1. Check logs:
   ```bash
   docker-compose logs budget-expense-ui
   ```

2. Verify environment variables:
   ```bash
   docker exec budget-expense-ui printenv
   ```

3. Check if port 3000 is available:
   ```bash
   lsof -i :3000
   ```

### Connection to SurrealDB Fails

1. Verify SurrealDB is accessible:
   ```bash
   curl -v https://api.bagayi.com
   ```

2. Check SURREAL_BASE_URL in `.env.production`

3. Verify network connectivity from container:
   ```bash
   docker exec budget-expense-ui ping api.bagayi.com
   ```

### Auth0 Issues

1. Verify Auth0 configuration in Auth0 Dashboard:
   - Allowed Callback URLs: `https://your-domain.com/api/auth/callback`
   - Allowed Logout URLs: `https://your-domain.com`
   - Allowed Web Origins: `https://your-domain.com`

2. Check AUTH0_SECRET is set correctly

3. Verify AUTH0_BASE_URL matches your actual domain

## Updating the Application

### Pull Latest Changes

```bash
git pull origin main
```

### Rebuild and Restart

```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Or Use Rolling Update

```bash
docker-compose up -d --build
```

## Backup and Restore

### Backup Application Data

Since this is a frontend application, there's no local data to backup. However, you should backup:

1. `.env.production` file (store securely)
2. Any custom configuration files

### Restore

Simply redeploy with your backed-up configuration files.

## Security Best Practices

1. **Never commit `.env.production` to version control**
2. **Use strong AUTH0_SECRET** (minimum 32 characters)
3. **Keep Docker image updated**: Regularly rebuild to get security patches
4. **Use HTTPS in production**: Always use a reverse proxy with SSL/TLS
5. **Limit container resources**: Use resource limits in docker-compose.yml
6. **Run as non-root user**: The Dockerfile already configures this
7. **Scan for vulnerabilities**:
   ```bash
   docker scan budget-expense-ui:latest
   ```

## Performance Optimization

### Multi-Stage Build Benefits

The Dockerfile uses multi-stage builds to:
- Reduce final image size (only ~100MB vs 1GB+)
- Remove unnecessary build dependencies
- Improve security by minimal attack surface

### Resource Limits

Adjust in `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      cpus: '2.0'      # Increase for better performance
      memory: 2G       # Increase if needed
    reservations:
      cpus: '1.0'
      memory: 1G
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build Docker image
        run: docker build -t budget-expense-ui:latest .
      
      - name: Push to registry
        run: |
          echo ${{ secrets.DOCKER_PASSWORD }} | docker login -u ${{ secrets.DOCKER_USERNAME }} --password-stdin
          docker push budget-expense-ui:latest
      
      - name: Deploy to server
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.HOST }}
          username: ${{ secrets.USERNAME }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd /path/to/app
            docker-compose pull
            docker-compose up -d
```

## Support

For issues or questions:
- Check the logs: `docker-compose logs -f`
- Review this documentation
- Check SurrealDB connectivity
- Verify Auth0 configuration

## Additional Resources

- [Next.js Docker Documentation](https://nextjs.org/docs/deployment#docker-image)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Auth0 Next.js SDK](https://github.com/auth0/nextjs-auth0)
- [SurrealDB Documentation](https://surrealdb.com/docs)
