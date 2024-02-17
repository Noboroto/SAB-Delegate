FROM node:alpine AS stage1

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

# Stage 2
FROM node:alpine
COPY --from=stage1 /usr/src/bot/node_modules ./root/node_modules
COPY --from=stage1 /usr/src/bot/node_modules /usr/src/bot/node_modules
WORKDIR /usr/src/bot

CMD [ "yarn", "start" ]