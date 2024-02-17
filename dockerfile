FROM node:alpine

# Create app directory
RUN mkdir -p /usr/src/bot
WORKDIR /usr/src/bot

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY ./root/package*.json ./
COPY ./root ./

RUN yarn --production --network-timeout 100000
# If you are building your code for production
# RUN npm --omit=dev

# Bundle app source
docker cp host-bot:/usr/src/bot/node_modules ./root/node_modules

CMD [ "yarn", "start" ]