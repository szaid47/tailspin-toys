import { eq, asc, and, inArray } from 'drizzle-orm';
import type { Database } from './db';
import { games, categories, publishers } from '../../db/schema';
import type { Category, Game, Publisher } from '../types/game';

/** Optional filters for narrowing the catalog by category and publisher. */
export interface GameFilters {
    categoryIds?: number[];
    publisherIds?: number[];
}

const gameSelection = {
    id: games.id,
    title: games.title,
    description: games.description,
    starRating: games.starRating,
    categoryId: categories.id,
    categoryName: categories.name,
    publisherId: publishers.id,
    publisherName: publishers.name,
};

type GameSelectionRow = {
    id: number;
    title: string;
    description: string;
    starRating: number | null;
    categoryId: number | null;
    categoryName: string | null;
    publisherId: number | null;
    publisherName: string | null;
};

function normalizeFilterValues(values: number[] | undefined): number[] {
    return Array.from(new Set((values ?? []).filter((value) => Number.isInteger(value) && value > 0)));
}

function mapGame(row: GameSelectionRow): Game {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        starRating: row.starRating,
        category:
            row.categoryId !== null && row.categoryName !== null
                ? { id: row.categoryId, name: row.categoryName }
                : null,
        publisher:
            row.publisherId !== null && row.publisherName !== null
                ? { id: row.publisherId, name: row.publisherName }
                : null,
    };
}

function baseGamesQuery(db: Database) {
    return db
        .select(gameSelection)
        .from(games)
        .leftJoin(categories, eq(games.categoryId, categories.id))
        .leftJoin(publishers, eq(games.publisherId, publishers.id));
}

function applyGameFilters(db: Database, filters: GameFilters = {}) {
    const categoryIds = normalizeFilterValues(filters.categoryIds);
    const publisherIds = normalizeFilterValues(filters.publisherIds);
    const whereClauses = [];

    if (categoryIds.length > 0) {
        whereClauses.push(inArray(games.categoryId, categoryIds));
    }

    if (publisherIds.length > 0) {
        whereClauses.push(inArray(games.publisherId, publisherIds));
    }

    const query = whereClauses.length > 0 ? baseGamesQuery(db).where(and(...whereClauses)) : baseGamesQuery(db);
    return query.orderBy(asc(games.title));
}

/** All games ordered by title, optionally narrowed to specific categories and publishers. */
export async function getAllGames(db: Database, filters: GameFilters = {}): Promise<Game[]> {
    const rows = await applyGameFilters(db, filters);
    return rows.map(mapGame);
}

/** All game ids ordered by title, optionally narrowed to specific categories and publishers. */
export async function getAllGameIds(db: Database, filters: GameFilters = {}): Promise<number[]> {
    const categoryIds = normalizeFilterValues(filters.categoryIds);
    const publisherIds = normalizeFilterValues(filters.publisherIds);
    const whereClauses = [];

    if (categoryIds.length > 0) {
        whereClauses.push(inArray(games.categoryId, categoryIds));
    }

    if (publisherIds.length > 0) {
        whereClauses.push(inArray(games.publisherId, publisherIds));
    }

    const query = whereClauses.length > 0
        ? db.select({ id: games.id }).from(games).where(and(...whereClauses))
        : db.select({ id: games.id }).from(games);

    const rows = await query.orderBy(asc(games.title));
    return rows.map((row) => row.id);
}

/** All available categories ordered by name. */
export async function getAllCategories(db: Database): Promise<Category[]> {
    const rows = await db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name));
    return rows;
}

/** All available publishers ordered by name. */
export async function getAllPublishers(db: Database): Promise<Publisher[]> {
    const rows = await db.select({ id: publishers.id, name: publishers.name }).from(publishers).orderBy(asc(publishers.name));
    return rows;
}

/** A single game by id, or null when it does not exist. */
export async function getGameById(db: Database, id: number): Promise<Game | null> {
    const row = await baseGamesQuery(db).where(eq(games.id, id)).get();
    return row ? mapGame(row) : null;
}
