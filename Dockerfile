FROM node:18-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for better caching
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Copy the rest of the application
COPY . .

# Install Python requirements if needed
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Create data directory
RUN mkdir -p /app/data

# Set environment variables
ENV NODE_ENV=production
ENV SIMULATION_MODE=true
ENV AUTO_START=true

# Expose ports if needed
EXPOSE 8080

# Run the bot
CMD ["node", "main.js"]
