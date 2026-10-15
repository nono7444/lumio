FROM node:22-alpine
WORKDIR /app
COPY server.js .
ENV PORT=3456 DATA_DIR=/data
VOLUME /data
EXPOSE 3456
USER node
CMD ["node", "server.js"]
