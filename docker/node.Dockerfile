# One image recipe for api, worker and simulator: build with --build-arg APP=<api|worker|simulator>.
FROM node:22-slim
ARG APP
ENV APP=${APP}
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci
CMD ["sh", "-c", "npm run start -w @standing/${APP}"]
