# Backend Mapero (API + web en tiempo real)
FROM node:20-alpine

WORKDIR /app

# Copia dependencias primero para aprovechar la caché de capas
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Código de la aplicación y web estática
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "src/index.js"]
