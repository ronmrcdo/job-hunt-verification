"""SQL-level tests for the Inngest event builder (spec §5.2).

These need a real Postgres — they run against the local Supabase database and
skip when none is reachable, so CI stays green without one. Get the URL from
`supabase status` if the default port differs.
"""
import os

import psycopg
import pytest

DB_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)


@pytest.fixture(scope="module")
def conn():
    try:
        c = psycopg.connect(DB_URL, connect_timeout=2)
    except psycopg.OperationalError:
        pytest.skip("no local Supabase database reachable; run `supabase start`")
    yield c
    c.close()


def test_builds_investigation_requested_with_id_equal_to_row_id(conn):
    inv_id = "3f4b2c1a-0000-4000-8000-000000000001"
    with conn.cursor() as cur:
        cur.execute("SELECT build_inngest_event(%s::uuid)", (inv_id,))
        event = cur.fetchone()[0]
    conn.rollback()
    assert event == {
        "name": "investigation.requested",
        "id": inv_id,                      # idempotency key = investigation id
        "data": {"investigation_id": inv_id},
    }


def test_rejects_a_null_investigation_id(conn):
    with conn.cursor() as cur:
        with pytest.raises(psycopg.errors.RaiseException):
            cur.execute("SELECT build_inngest_event(NULL)")
    conn.rollback()
