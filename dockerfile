FROM node:16

# Create app directory
RUN mkdir -p /usr/src/bot
WORKDIR /usr/src/bot

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY ./root/package*.json ./
COPY ./root ./

RUN yarn install --omit=dev
# If you are building your code for production
# RUN npm --omit=dev

# Bundle app source

CMD [ "yarn", "start" ]