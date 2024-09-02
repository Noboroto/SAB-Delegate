FROM node:18-alpine3.20

# Create app directory
RUN mkdir -p /usr/src/bot
WORKDIR /usr/src/bot

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY ./root/package*.json ./
COPY ./root ./

RUN echo $TOKEN
RUN echo $TOKENS

RUN yarn --production --network-timeout 100000
# If you are building your code for production
# RUN npm --omit=dev

# Bundle app source
# CMD ["ls", "-la"]
CMD [ "yarn", "start" ] 