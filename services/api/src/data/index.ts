import { createMemoryRepository } from "./memory-repository";
import { createMongoRepository } from "./mongo-repository";
import { DataRepository } from "./types";

let repository: DataRepository | null = null;
let driver: "memory" | "mongo" = "memory";

function normalizeDriver(input: string | undefined): "memory" | "mongo" | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  if (v === "memory") return "memory";
  if (v === "mongo") return "mongo";
  return null;
}

export async function initDataRepository(): Promise<DataRepository> {
  if (repository) return repository;

  const explicit = normalizeDriver(process.env.DATA_DRIVER);
  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const dbName = process.env.MONGODB_DB || "cbsp";

  if (explicit === "memory") {
    driver = "memory";
    repository = createMemoryRepository();
    return repository;
  }

  const shouldTryMongo = explicit === "mongo" || Boolean(process.env.MONGODB_URI);

  if (shouldTryMongo) {
    try {
      repository = await createMongoRepository(mongoUri, dbName);
      driver = "mongo";
      return repository;
    } catch (err) {
      console.error("[data] mongo init failed, fallback to memory:", err);
    }
  }

  repository = createMemoryRepository();
  driver = "memory";
  return repository;
}

export function getDataRepository(): DataRepository {
  if (!repository) throw new Error("Data repository is not initialized");
  return repository;
}

export function getDataDriver(): "memory" | "mongo" {
  return driver;
}

export async function closeDataRepository(): Promise<void> {
  if (!repository) return;
  if (typeof repository.close === "function") {
    await repository.close();
  }
  repository = null;
}
