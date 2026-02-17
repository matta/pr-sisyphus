FROM node:24-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci --production
RUN npm cache clean --force
ENV NODE_ENV="production"
COPY . .
CMD [ "npm", "start" ]
