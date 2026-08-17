# Dockerfile for Nexis alert forwarder

FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json package-lock.json* ./
RUN npm install --production --silent

# Bundle app source
COPY . .

# Use an unprivileged user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
