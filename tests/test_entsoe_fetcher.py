import unittest
from datetime import date, datetime, timedelta, timezone

from entsoe_fetcher import (
    delivery_window_local,
    filter_prices_by_delivery_date,
    retained_delivery_dates,
)


class DeliveryRetentionTests(unittest.TestCase):
    def test_retained_delivery_dates_include_yesterday_today_and_tomorrow(self) -> None:
        now = datetime(2026, 3, 17, 15, 30, tzinfo=timezone(timedelta(hours=1)))

        self.assertEqual(
            retained_delivery_dates(now),
            {
                date(2026, 3, 16),
                date(2026, 3, 17),
                date(2026, 3, 18),
            },
        )

    def test_delivery_window_spans_retained_local_days(self) -> None:
        zone = timezone(timedelta(hours=1))
        now = datetime(2026, 3, 17, 15, 30, tzinfo=zone)

        start_local, end_local = delivery_window_local(now_local=now, zone=zone)

        self.assertEqual(start_local.isoformat(), "2026-03-16T00:00:00+01:00")
        self.assertEqual(end_local.isoformat(), "2026-03-19T00:00:00+01:00")

    def test_filter_prices_by_delivery_date_keeps_whole_local_days(self) -> None:
        entries = [
            {"start_local": "2026-03-15T23:45:00+01:00"},
            {"start_local": "2026-03-16T00:00:00+01:00"},
            {"start_local": "2026-03-17T12:00:00+01:00"},
            {"start_local": "2026-03-18T23:45:00+01:00"},
            {"start_local": "2026-03-19T00:00:00+01:00"},
        ]

        retained = filter_prices_by_delivery_date(
            prices=entries,
            delivery_dates={date(2026, 3, 16), date(2026, 3, 17), date(2026, 3, 18)},
        )

        self.assertEqual(
            [entry["start_local"] for entry in retained],
            [
                "2026-03-16T00:00:00+01:00",
                "2026-03-17T12:00:00+01:00",
                "2026-03-18T23:45:00+01:00",
            ],
        )


if __name__ == "__main__":
    unittest.main()
