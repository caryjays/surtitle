import unittest
from host_probe import classify, parse_registry, shares

# As ioreg prints it: one +-o node per client, properties in alphabetical order, so AppUsage precedes its creator.
REGISTRY = '''
+-o AGXAccelerator  <class AGXAccelerator>
    {
      "PerformanceStatistics" = {"Tiler Utilization %"=5,"Device Utilization %"=42,"Renderer Utilization %"=20}
    }
  +-o AGXDeviceUserClient  <class AGXDeviceUserClient>
  |   {
  |     "AppUsage" = ({"API"="Metal","accumulatedGPUTime"=1000000000},{"API"="Metal","accumulatedGPUTime"=500000000})
  |     "IOUserClientCreator" = "pid 606, WindowServer"
  |   }
  +-o AGXDeviceUserClient  <class AGXDeviceUserClient>
  |   {
  |     "AppUsage" = ({"API"="Metal","accumulatedGPUTime"=2000000000})
  |     "IOUserClientCreator" = "pid 700, OBS"
  |   }
  +-o AGXDeviceUserClient  <class AGXDeviceUserClient>
  |   {
  |     "AppUsage" = ()
  |     "IOUserClientCreator" = "pid 701, ControlCenter"
  |   }
  +-o AGXDeviceUserClient  <class AGXDeviceUserClient>
  |   {
  |     "AppUsage" = ({"API"="Metal","accumulatedGPUTime"=3000000000})
  |     "IOUserClientCreator" = "pid 900, python3.12"
  |   }
  +-o AGXDeviceUserClient  <class AGXDeviceUserClient>
  |   {
  |     "AppUsage" = ({"API"="Metal","accumulatedGPUTime"=7000000000})
  |     "IOUserClientCreator" = "pid 606, WindowServer"
  |   }
'''


class HostProbeTests(unittest.TestCase):
    def test_parse_credits_each_client_node(self):
        clients = parse_registry(REGISTRY)
        # Two WindowServer clients sum; each AppUsage belongs to the creator after it in the same node.
        self.assertEqual(clients[(606, 'WindowServer')], 8_500_000_000)
        self.assertEqual(clients[(700, 'OBS')], 2_000_000_000)
        self.assertEqual(clients[(701, 'ControlCenter')], 0)
        self.assertEqual(clients[(900, 'python3.12')], 3_000_000_000)

    def test_classify_by_parent_then_name(self):
        self.assertEqual(classify(900, 'python3.12', {900}), 'ours')
        self.assertEqual(classify(901, 'python3.12', {900}), 'other')
        self.assertEqual(classify(1, 'obs-browser-page', set()), 'obs')
        self.assertEqual(classify(1, 'Google Chrome He', set()), 'browser')
        self.assertEqual(classify(1, 'WindowServer', set()), 'windowServer')

    def test_shares_are_deltas_over_the_interval(self):
        before = parse_registry(REGISTRY)
        after = dict(before)
        after[(700, 'OBS')] += 1_000_000_000      # busy half of a 2 s interval
        after[(900, 'python3.12')] += 1_500_000_000
        after[(606, 'WindowServer')] = 100           # pid reused: counts from zero
        result = shares(before, after, {900}, 2_000_000_000)
        self.assertEqual(result['obs'], 0.5)
        self.assertEqual(result['ours'], 0.75)
        self.assertEqual(result['windowServer'], 0.0)
        self.assertEqual(result['browser'], 0.0)

    def test_new_client_counts_from_zero(self):
        result = shares({}, {(5, 'Google Chrome He'): 400_000_000}, set(), 2_000_000_000)
        self.assertEqual(result['browser'], 0.2)


if __name__ == '__main__':
    unittest.main()
