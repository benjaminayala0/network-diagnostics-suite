FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3002
EXPOSE 1161/udp
EXPOSE 2222

CMD ["npm", "start"]

