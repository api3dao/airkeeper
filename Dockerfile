FROM node:14.17-alpine3.14

LABEL application=airkeeper \
    description="Airkeeper lambda function"

RUN apk add --update --no-cache git python3 make g++\
    && rm -rf /var/cache/apk/*

RUN git clone --single-branch --branch main https://github.com/api3dao/airkeeper.git

WORKDIR /airkeeper

RUN npm install

CMD npm run sls:config \
    && npm run sls:$COMMAND
