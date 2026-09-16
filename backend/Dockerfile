FROM node:22-slim

# Required for sharp (libvips native binaries) on Debian/Koyeb
RUN apt-get update && apt-get install -y \
    libvips-dev \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first (layer caching)
COPY package*.json ./

# Install dependencies (sharp native build included)
RUN npm install

# Generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# Copy rest of source
COPY . .

EXPOSE 4000

CMD ["npm", "start"]
