import unittest
from zoneinfo import ZoneInfo

from entsoe_fetcher import parse_entsoe_prices


class ParseEntsoePricesTests(unittest.TestCase):
    def test_prefers_more_complete_series_for_duplicate_intervals(self) -> None:
        xml_text = """\
<?xml version="1.0" encoding="utf-8"?>
<Publication_MarketDocument xmlns="urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3">
  <TimeSeries>
    <mRID>2</mRID>
    <classificationSequence_AttributeInstanceComponent.position>2</classificationSequence_AttributeInstanceComponent.position>
    <Period>
      <timeInterval>
        <start>2026-03-20T23:00Z</start>
        <end>2026-03-21T00:00Z</end>
      </timeInterval>
      <resolution>PT15M</resolution>
      <Point><position>1</position><price.amount>10</price.amount></Point>
      <Point><position>2</position><price.amount>11</price.amount></Point>
      <Point><position>3</position><price.amount>12</price.amount></Point>
    </Period>
  </TimeSeries>
  <TimeSeries>
    <mRID>1</mRID>
    <classificationSequence_AttributeInstanceComponent.position>1</classificationSequence_AttributeInstanceComponent.position>
    <Period>
      <timeInterval>
        <start>2026-03-20T23:00Z</start>
        <end>2026-03-21T00:00Z</end>
      </timeInterval>
      <resolution>PT15M</resolution>
      <Point><position>1</position><price.amount>20</price.amount></Point>
      <Point><position>2</position><price.amount>21</price.amount></Point>
      <Point><position>3</position><price.amount>22</price.amount></Point>
      <Point><position>4</position><price.amount>23</price.amount></Point>
    </Period>
  </TimeSeries>
</Publication_MarketDocument>
"""
        prices = parse_entsoe_prices(xml_text=xml_text, zone=ZoneInfo("Europe/Berlin"))

        self.assertEqual(len(prices), 4)
        self.assertEqual([price["price_per_mwh_eur"] for price in prices], [20.0, 21.0, 22.0, 23.0])

    def test_prefers_lower_classification_sequence_when_point_counts_tie(self) -> None:
        xml_text = """\
<?xml version="1.0" encoding="utf-8"?>
<Publication_MarketDocument xmlns="urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3">
  <TimeSeries>
    <mRID>2</mRID>
    <classificationSequence_AttributeInstanceComponent.position>2</classificationSequence_AttributeInstanceComponent.position>
    <Period>
      <timeInterval>
        <start>2026-03-20T23:00Z</start>
        <end>2026-03-21T00:00Z</end>
      </timeInterval>
      <resolution>PT15M</resolution>
      <Point><position>1</position><price.amount>30.100001</price.amount></Point>
      <Point><position>2</position><price.amount>31.100001</price.amount></Point>
      <Point><position>3</position><price.amount>32.100001</price.amount></Point>
      <Point><position>4</position><price.amount>33.100001</price.amount></Point>
    </Period>
  </TimeSeries>
  <TimeSeries>
    <mRID>1</mRID>
    <Period>
      <timeInterval>
        <start>2026-03-20T23:00Z</start>
        <end>2026-03-21T00:00Z</end>
      </timeInterval>
      <resolution>PT15M</resolution>
      <Point><position>1</position><price.amount>30.1</price.amount></Point>
      <Point><position>2</position><price.amount>31.1</price.amount></Point>
      <Point><position>3</position><price.amount>32.1</price.amount></Point>
      <Point><position>4</position><price.amount>33.1</price.amount></Point>
    </Period>
  </TimeSeries>
</Publication_MarketDocument>
"""
        prices = parse_entsoe_prices(xml_text=xml_text, zone=ZoneInfo("Europe/Copenhagen"))

        self.assertEqual(len(prices), 4)
        self.assertEqual([price["price_per_mwh_eur"] for price in prices], [30.1, 31.1, 32.1, 33.1])


if __name__ == "__main__":
    unittest.main()
