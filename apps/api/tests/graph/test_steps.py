from app.graph.steps import STEP_REGISTRY, StepDef
from app.graph.build import build_graph


def test_registry_covers_user_meaningful_nodes_in_order():
    keys = [s.step_key for s in sorted(STEP_REGISTRY.values(), key=lambda s: s.display_order)]
    assert keys == ["intake", "deterministic_checks", "company_research",
                    "evidence_analysis", "devils_advocate", "report"]


def test_registry_node_names_exist_in_the_compiled_graph():
    graph_nodes = set(build_graph().get_graph().nodes)   # node names wired in build.py
    for node_name in STEP_REGISTRY:
        assert node_name in graph_nodes, f"{node_name} not a real graph node"
