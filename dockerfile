FROM node:16

# Create app directory
RUN mkdir -p /usr/src/bot
WORKDIR /usr/src/bot

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY ./source/package*.json ./
COPY ./source ./

RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source

CMD [ "node", "delete-all-commands.js"]
CMD [ "node", "deploy-global-commands.js"]
CMD [ "node", "main.js" ]