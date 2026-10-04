/**
 * A small H.264 stream for the tests, made with
 *
 *   ffmpeg -f lavfi -i testsrc2=size=96x40:rate=10 -frames:v 3 -c:v libx264 -profile:v high -bf 0 -g 10
 *     -x264-params slices=2:aud=0:repeat-headers=1:annexb=1 -f h264 tiny.h264
 *
 * Its first frame is an SPS (with an emulation prevention byte in it), a PPS,
 * x264's SEI and an IDR picture in two slices; the next two are two slices
 * each. Some of its start codes are 3 bytes long, some 4.
 */
export const TINY_HIGH = Uint8Array.from(atob(
  "AAAAAWdkAAqssgz/LgIgAAADACAAAAMCgeJEyQAAAAFo68PLIsAAAAEGBf//dNxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjIgYjM1NjA1" +
  "YSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRp" +
  "b25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBt" +
  "aXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNo" +
  "cm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBzbGljZXM9MiBucj0wIGRlY2ltYXRlPTEg" +
  "aW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTIga2V5aW50PTEwIGtleWludF9taW49" +
  "MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTEwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAg" +
  "cXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAWWIhBH/2uOX08QHO1K6iOlnZeKNoRFWwV0QzcpW/TGbusLaAF7VzNPWFYxb" +
  "3YoVy1PSRJ72qKcKe3I2lLBKIaBOmp9q52fjsFndkCnbCUYih5FeyoOkCRFN3iO7aVKcg/0QLVKnSR4udXajRs6p5KxO/8EqGU3ZL7vLyR96N0r+juvepbR8" +
  "wntt8b4lV9hqmkB8AzbbGtX9wJ+j0y6nts1Gst2zTavv9dNnmOAi6pdM7nYVfAHZRLIVYlVq1YYEZQ5EwqCxLqjwt0sBfK0Jbn90Tp7L/luZ8Ht7Q7KWtt7Y" +
  "LG2PbvKw1ApbJdBLYSyueuSthK2BScI7X0A4hNGn6D/2MP3EjoWhbl+IpqHhUuQ5+oyOLUPVWb/Dm4uF5eJahq45dDAC2s5o0h5bONziTzpcFLBAMz2Wq/9f" +
  "zX2GOcQUmtazJzJh/1ogRpUPKDppvE8m7UDqjC8+vIGjkj80VeEuymkbVdqaunq2N6Jr3DjTWaG093KXQr+nFAvx4cEyvSX7ZMMu3UNsZ3Tmd0SnG80HgDJO" +
  "HX5nTF/po/2ojgEFBYqDMnwh+MsOv+YCpG6I31qCyn7tDfDOTO/3H38A+bPawISANAcSkxtS/1lOUNmz0yN9Tk6ximJwT/NxoLnZDASu+QCbvRKNwxQHqv2+" +
  "JxQdVzU2tPt1IRMS9g4FRYxNiZE4Vq98Eud1UByjdAu9rJxD2GA5a9tKcd86eAARdWTT1Dgu8zKGiGgvuhAKLJg4DSChLuh7ZL1xZdHUL+1jEXlVBGYrHw7m" +
  "H7Lu/iwfqZzdDJCLNJTA6Czh+X/0J/m+lOyQha3AtooeQ5Ek+W/mLCltMja8kMuVrstvBnW5fzT8ucBESzTazl01Pl1vvDmbfZDVoHc6emj6aXrO8bOP0ZRg" +
  "/PdYpXI9Akl7xCRbSJFhG2qbbHRtshgodX6o4s8GimF8dW+8Se7PRIqnOXKc3fmqMZFXdLfeGrOqHMN2f9/JUBFhfk9nl6CGblwh0YAehhPciaCBps874s2Z" +
  "Og3KgvvK+CzMdJsxNExxWxYF6fmmrPJF1kqFOe/LjA5qWbx4kOVT35aQ0rjhP06tBoJb2f+XuanE+110nuHzAQuRB1FLugqBDZMuHHpcWlkL6sFduvV8gmLa" +
  "Wz4ptsRNVGMUzC/gXQ4mg7xRBG9hryeABrH8CizQz1MSUOmDzeM/UKoPlG+9QRQkQ2V9K0YLrDznpwrsXmaE1LQQn7/UmIT3eKGZi/tC+UBAWtfaoOoB1Gxe" +
  "1HcR2NvhT+4Kmk/P5mnNxvM0LRu0yTlSZOCu4UsgCM+DvjS96c/z07S+arsK/7KiaMj6ki8AAAFlGiIQ3+YITaeX8kVRF5klnOSVrDFIx9JKeUjWCHdfb/2L" +
  "KyCnPwUXxk1G/O8bZ93B5vk1uApmOISznXif7A0kFjOIcWO3L8vz6lfeAFAOQMExsifmvGqA9czyizpXeYI3OfGOTRP5LKCq6CK/3MKvhRbYk/jZmGVWCZ8/" +
  "pWJyrduFAJcYqMU7jid2xykt5YgEIoWB/goSkU1LwXnLBUCbs4w11zANX9rYC+T+E8bgJCs9fEYX2X0AAAABQZo7EZ/CmD3YD5DbokqStxaPnBz4x6efPrOm" +
  "TlVx3MR32C1Ftbf/H8hgr85LyR51OQH+I+qWzNEVvErJdxfADCvEtI1UgPWrwFgUf9bUzlpnqqzevrnNo9+c4mVkoZHh4lbPWLKQnAMHQb/FElIGoW0T6iTK" +
  "vLYkvB+6sUHD97SmHvzayf0s3qDW4rxGWiEYPP4yxtzx33klHbfNK+99QJjzA73G2IFZa7vV1C7r+AAAAUEaaOxEfxxwAAAAAUGaTwhkymEd//pU90Qd59SM" +
  "YHZacf29B/nkLC2h7t+nCFWqgjnzIiQczvZHto+tspMiXgxflIWOCekDGUXjKIvsKMXmmphZv3V+8QCJfvcjQXZxi+ldLAUBWjgiM6P0ie3STc7us5umo557" +
  "yY/nvOD/JbpVjADFKooBQy9M1AFgjw5Zft0rU7zO3b0CVUNPe+lBI3LS2AZJ8VMKWt/aYd35AAABQRppPCGTKYRnKSE=",
), (c) => c.charCodeAt(0));

/** Where its frames start: the IDR frame, then the two others. */
export const TINY_HIGH_FRAMES = [0, 1859, 2049];

/** The SPS of a 176x144 stream from the same encoder with the baseline profile. */
export const BASELINE_SPS_176x144 = Uint8Array.from("000000016742c00ad902c4ec0440000003004000000503c48992".match(/../g)!, (h) => parseInt(h, 16));
