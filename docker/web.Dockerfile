FROM node:22-slim
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci
# Both values are read at BUILD time: API_URL is baked into the /api rewrite, NEXT_PUBLIC_DEMO_LOGIN into the client bundle.
ARG API_URL=http://api:4100
ARG NEXT_PUBLIC_DEMO_LOGIN=1
ENV API_URL=${API_URL} NEXT_PUBLIC_DEMO_LOGIN=${NEXT_PUBLIC_DEMO_LOGIN}
RUN npm run build -w @standing/web
ENV PORT=3000 HOST=0.0.0.0
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@standing/web"]
