FROM node:22-alpine
WORKDIR /app
COPY package.json package.json
COPY server.js server.js
COPY public public
COPY docs docs
COPY .env.example .env.example
RUN mkdir -p data
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
