import asyncio
import json
import sys
from sync_runt import run_sync_driver

async def main():
    res = await run_sync_driver("91264273", "Innova", "FLOTA PROPIA")
    print(json.dumps(res, indent=4, ensure_ascii=False))

if __name__ == "__main__":
    asyncio.run(main())
