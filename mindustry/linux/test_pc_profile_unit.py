import unittest

from test_pc_profile import validate_state


def state(**changes):
    result = {
        "schemaVersion": 1, "ready": True, "playing": True,
        "gameOver": False, "won": False,
        "tick": 123, "wave": 1, "width": 200, "height": 200,
        "core": {"x": 50, "y": 50, "health": 4000},
    }
    result.update(changes)
    return result


class ReadOnlyProfileTests(unittest.TestCase):
    def test_accepts_real_shaped_active_snapshot(self):
        self.assertEqual(validate_state(state())["tick"], 123)
        self.assertEqual(validate_state(state())["width"], 200)

    def test_rejects_missing_core_or_dead_game(self):
        for invalid in (state(core=None), state(playing=False), state(ready=False),
                        state(gameOver=True), state(won=True),
                        state(core={"health": 0}), state(schemaVersion=2)):
            with self.subTest(invalid=invalid), self.assertRaises(RuntimeError):
                validate_state(invalid)

    def test_keeps_only_numeric_game_state_for_timing_metrics(self):
        self.assertEqual(
            validate_state(state(tick=999, wave=3)),
            {"tick": 999, "wave": 3, "width": 200, "height": 200},
        )


if __name__ == "__main__":
    unittest.main()
