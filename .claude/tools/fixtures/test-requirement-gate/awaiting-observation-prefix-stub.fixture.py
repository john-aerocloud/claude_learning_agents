# PROOF-OF-FIRE SEED — NOT A TEST. This file is never executed; it is scanned.
#
# Founding evidence instance 2 (2026-08-02). The `awaiting_observation` liveness
# probe maps a target's exit status + stdout sentinel onto observed / not-yet /
# broken. Its FIRST test stubbed `subprocess.run` and asserted the mapping — in the
# engineer's own words it "only proved the mapping agreed with itself". Against a
# real `make` every probe read BROKEN, because make does not propagate a recipe's
# exit status: a recipe exiting 3 makes make print `Error 3` and exit 2.
#
# The stub could not contain that fact, because the fact belongs to make, and the
# stub was written by the same person who was wrong about make. Reconstructed here
# in the shape it had (the corrected real-make version and this one landed in the
# same commit 75516bd, so there is no pre-fix sha to quote — stated plainly rather
# than dressed up as a recovery).
#
# The CORRECTED test drives real `make` against a real temp Makefile. It contains no
# stub of the exec boundary at all, and therefore scans clean.

import unittest
import work_items as wi


class ObservationProbeMapping(unittest.TestCase):
    def test_exit_zero_is_observed(self):
        class R:
            returncode, stdout, stderr = 0, "OBSERVATION: observed", ""

        orig = wi.subprocess.run
        wi.subprocess.run = lambda argv, **kw: R()
        try:
            self.assertEqual(wi._run_observation("P", "make:probe-x")[0], "observed")
        finally:
            wi.subprocess.run = orig

    def test_exit_three_is_not_yet(self):
        class R:
            returncode, stdout, stderr = 3, "", ""

        orig = wi.subprocess.run
        wi.subprocess.run = lambda argv, **kw: R()
        try:
            self.assertEqual(wi._run_observation("P", "make:probe-x")[0], "not-yet")
        finally:
            wi.subprocess.run = orig
