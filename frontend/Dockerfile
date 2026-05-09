FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY src/ /app/
RUN npm install
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
