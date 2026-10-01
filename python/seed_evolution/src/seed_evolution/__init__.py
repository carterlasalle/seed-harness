"""seed-evolution: evolution-loop package (GEPA contract, scientist, mutation).

Purpose: Python home of the lab evolution loop per REQ-SEED-D5V8QCMS and the
CLI/CI slice per REQ-SEED-EZPD6B85. Why it exists: keeps evolvable strategy
code (prompts, mutations) out of the immutable guardian. Invariant: stdlib
only. Public functions/types: protocol, dataset, statistics, trace_analysis,
mechanism_search, gepa_optimizer submodules.
"""

from . import (
    dataset,
    gepa_optimizer,
    mechanism_search,
    protocol,
    statistics,
    trace_analysis,
)

__all__ = ["dataset", "gepa_optimizer", "mechanism_search", "protocol", "statistics", "trace_analysis"]
