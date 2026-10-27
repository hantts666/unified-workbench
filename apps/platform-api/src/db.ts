import {PrismaClient} from '../../../.generated/platform/index.js';
if(!process.env.PLATFORM_DATABASE_URL)throw new Error('PLATFORM_DATABASE_URL is required');
export const db=new PrismaClient({datasourceUrl:process.env.PLATFORM_DATABASE_URL});
