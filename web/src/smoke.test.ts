describe("test runner", () => {
  it("runs with WebCrypto available", async () => {
    expect(typeof crypto.subtle.digest).toBe("function");
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([1])));
    expect(d.length).toBe(32);
  });
});
