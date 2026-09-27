"use client";

import { useState } from "react";
import { listLegalReferences } from "@vsm/simulation-core";

const references = listLegalReferences();

export function LegalLibrary() {
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase("ru");
  const visible = references.filter((reference) =>
    `${reference.act} ${reference.clause} ${reference.applications.join(" ")} ${reference.scenes.map(scene => scene.title).join(" ")}`
      .toLocaleLowerCase("ru").includes(search));
  const acts = [...new Set(visible.map(reference => reference.act))];

  return <section className="vn-tab-content vn-law-library" aria-label="Нормативные основания">
    <h2>Правила</h2>
    <label className="vn-law-search">
      <span className="vn-sr-only">Поиск по нормативным пунктам</span>
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти пункт или ситуацию" />
    </label>
    <div className="vn-law-groups">
      {acts.map(act => <section key={act} className="vn-law-group" aria-label={act}>
        <h3>{act}</h3>
        {visible.filter(reference => reference.act === act).map(reference =>
          <article className="vn-law-entry" key={`${reference.act}:${reference.clause}`}>
            <div className="vn-law-entry-heading"><strong>{reference.clause}</strong><span>{reference.scenes.length} {reference.scenes.length === 1 ? "сцена" : "сцен"}</span></div>
            {reference.applications.map(application =>
              <a key={application} href={reference.url} className="vn-law-excerpt" aria-label={`${reference.act}, ${reference.clause}. ${application} Открыть официальный документ`}>
                {application}<span aria-hidden="true">↗</span>
              </a>)}
            <p className="vn-law-scenes">{reference.scenes.map(scene => scene.title).join(" · ")}</p>
          </article>)}
      </section>)}
      {!visible.length && <p className="vn-law-empty">Ничего не найдено</p>}
      <div className="vn-law-sources">
        <span>ОФИЦИАЛЬНЫЕ ПУБЛИКАЦИИ</span>
        <a href="https://publication.pravo.gov.ru/Document/View/0001202210270033">Приказ № 352 ↗</a>
        <a href="https://publication.pravo.gov.ru/Document/View/0001202503140005">Изменения 2025 ↗</a>
        <a href="https://publication.pravo.gov.ru/Document/View/0001202603110006">Изменения 2026 ↗</a>
        <a href="https://publication.pravo.gov.ru/Document/View/0001201302250007">ФЗ № 15 ↗</a>
      </div>
    </div>
  </section>;
}
