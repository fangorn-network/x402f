FROM node:22-alpine
RUN npm install -g pnpm
WORKDIR /app
# Copy workspace config first
# COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
# Copy all packages (needed for local deps like fangorn-sdk)
COPY . .
# Install deps using the lockfile
RUN pnpm install --no-frozen-lockfile
# RUN CI=true pnpm install
EXPOSE 30333
CMD ["npx", "tsx", "packages/facilitator/src/index.ts"]