FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY . .

RUN mkdir -p sessions logs

EXPOSE 3000

CMD ["node", "src/index.js"]
