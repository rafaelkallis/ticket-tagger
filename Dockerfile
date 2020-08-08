FROM node:12

WORKDIR app
COPY ./ ./

RUN npm install --production

CMD ["npm", "start"]
