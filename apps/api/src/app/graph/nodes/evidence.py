from app.graph.state import InvestigationState

def evidence_assembly(state: InvestigationState) -> dict:
    id_map: dict[str, str] = {}          # old id -> canonical id
    url_to_canonical: dict[str, str] = {}
    canonical_sources = []
    counter = 1

    for src in state.sources:
        if src.id.startswith("src_det_"):        # already canonical deterministic source
            id_map[src.id] = src.id
            canonical_sources.append(src)
            continue
        if src.url and src.url in url_to_canonical:  # duplicate web source
            id_map[src.id] = url_to_canonical[src.url]
            continue
        new_id = f"src_{counter:03d}"
        counter += 1
        id_map[src.id] = new_id
        if src.url:
            url_to_canonical[src.url] = new_id
        canonical_sources.append(src.model_copy(update={"id": new_id}))

    remapped_findings = []
    for f in state.findings:
        new_ids = [id_map.get(sid, sid) for sid in f.source_ids]
        # collapse duplicates introduced by dedupe, preserve order
        seen, ordered = set(), []
        for i in new_ids:
            if i not in seen:
                seen.add(i); ordered.append(i)
        remapped_findings.append(f.model_copy(update={"source_ids": ordered}))

    return {"sources": canonical_sources, "findings": remapped_findings}
