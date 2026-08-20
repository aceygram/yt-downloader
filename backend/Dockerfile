FROM node:18-slim

# Install python3, pip, and ffmpeg — yt-dlp needs python to run, ffmpeg to merge streams
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg && \
    pip3 install --break-system-packages -U yt-dlp

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN chmod +x entrypoint.sh

EXPOSE 3000
CMD ["./entrypoint.sh"]
