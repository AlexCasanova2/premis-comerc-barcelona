import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.js";

test("registration API validates, persists and reports storage failures", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "premi-test-"));
  const server = createApp({
    dataDir: dir,
    adminUsername: "gestio",
    adminPassword: "secret-test",
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}/api/inscripcions`;
  const send = (body) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const valid = {
    nom: "Prova",
    cognom: "Formulari",
    email: "prova@example.com",
    telefon: "+34 600 000 000",
    entitat: "Entitat de prova",
    adreca: "Carrer de prova, 1",
    acompanyant: "No",
    assistencia: "Sí",
    mobilitat: "No",
    consentiment: true,
  };
  assert.equal((await send({})).status, 400);
  assert.equal((await send({ ...valid, consentiment: false })).status, 400);
  assert.equal((await send({ ...valid, email: "invalid" })).status, 400);
  assert.equal((await send({ ...valid, acompanyant: "Sí" })).status, 400);
  assert.equal((await send({ ...valid, mobilitat: "maybe" })).status, 400);
  const response = await send({ ...valid, nomAcompanyant: "Stale value" });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).ok, true);
  assert.equal(
    (
      await send({
        ...valid,
        acompanyant: "Sí",
        nomAcompanyant: "Acompanyant",
        cognomAcompanyant: "Prova",
        mobilitat: "Sí",
      })
    ).status,
    201,
  );
  const entries = (await readFile(join(dir, "inscripcions.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].nomAcompanyant, "");
  assert.equal(entries[1].nomAcompanyant, "Acompanyant");
  assert.equal(entries[0].consentiment, true);
  assert.ok(entries[0].createdAt);
  assert.notEqual(entries[0].id, entries[1].id);

  const adminUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
  assert.equal((await fetch(`${adminUrl}/inscripcions`)).status, 401);
  const authorization = `Basic ${Buffer.from("gestio:secret-test").toString("base64")}`;
  const adminResponse = await fetch(`${adminUrl}/inscripcions`, {
    headers: { Authorization: authorization },
  });
  assert.equal(adminResponse.status, 200);
  const adminEntries = (await adminResponse.json()).registrations;
  assert.equal(adminEntries.length, 2);
  assert.equal(adminEntries[0].nomAcompanyant, "Acompanyant");

  const csvResponse = await fetch(`${adminUrl}/inscripcions.csv`, {
    headers: { Authorization: authorization },
  });
  assert.equal(csvResponse.status, 200);
  assert.match(csvResponse.headers.get("content-type"), /text\/csv/);
  assert.match(
    csvResponse.headers.get("content-disposition"),
    /inscripcions-premi-comerc-barcelona\.csv/,
  );
  const csvBytes = new Uint8Array(await csvResponse.arrayBuffer());
  assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = new TextDecoder().decode(csvBytes);
  assert.match(csv, /"Prova"/);
  assert.match(csv, /"Acompanyant"/);

  const failingServer = createApp({
    dataDir: join(dir, "inscripcions.jsonl"),
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => failingServer.once("listening", resolve));
  t.after(() => new Promise((resolve) => failingServer.close(resolve)));
  const failure = await fetch(
    `http://127.0.0.1:${failingServer.address().port}/api/inscripcions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(valid),
    },
  );
  assert.equal(failure.status, 500);
  assert.equal((await failure.json()).ok, undefined);
});
