# ==========================================
# Stage 1: Dependencies
# ==========================================
FROM node:20-alpine AS deps

# Install libc6-compat for compatibility
RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install

COPY . .

CMD [ "npm", "run", "dev" ]
