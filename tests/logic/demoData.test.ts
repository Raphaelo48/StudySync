import { openTestDb, fixedNow } from '../support/helpers';
import { hasUserData, seedDemoData } from '../../src/logic/demoData';
import { describeEvent } from '../../src/logic/eventDisplay';
import { buildDigest } from '../../src/logic/morningDigest';
import { exportAll, parseBackup, serializeBackup } from '../../src/logic/backup';
import { DAY_MS, startOfDay } from '../../src/core/time';

const NOW = fixedNow();

describe('Демо-данные', () => {
  it('заполняют все разделы и согласованы между собой', async () => {
    const { db } = await openTestDb();
    expect(await hasUserData(db)).toBe(false);
    const r = await seedDemoData(db, NOW);
    expect(r).toMatchObject({ subjects: 5, lessons: 33, tasks: 5, debts: 2 });
    expect(r.sessions).toBeGreaterThan(10);
    expect(await hasUserData(db)).toBe(true);

    const today = await db.events.listRange(startOfDay(NOW), startOfDay(NOW) + DAY_MS);
    expect(today.length).toBeGreaterThan(0);
    const info = describeEvent(today[0]!);
    expect(info.teacher).toBeTruthy();
    expect(info.kindLabel).toBeTruthy();

    expect(await db.debts.countOpen()).toBe(2);
    expect((await db.lessonNotes.listAll()).length).toBe(1);
    const tomorrow = startOfDay(NOW) + DAY_MS;
    const digest = buildDigest(tomorrow, await db.events.listRange(tomorrow, tomorrow + 2 * DAY_MS), await db.tasks.list({ status: 'active' }, NOW));
    expect(digest).not.toBeNull();

    // Резервная копия с демо-данными валидна.
    const json = serializeBackup(await exportAll(db, NOW));
    expect(() => parseBackup(json)).not.toThrow();
  });
});
