import pg from 'pg'
import Pool from 'pg-pool'
import dotenv from 'dotenv'

dotenv.config()

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
})

pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error acquiring client', err.stack)
  }
  console.log('Connected to PostgreSQL successfully!')
  release()
})

// USERS
export async function getUsers(){
    const result = await pool.query(`SELECT * FROM users_info ui JOIN users u ON u.uid=ui.uid `)
    return result.rows
}

export async function registerUser(fname,mname,lname,course,role,phone,email,password,status){     
    const conn = await pool.connect()

    let sid = null    
    
    try {
        if (role === 'STUDENT') {
            sid = await generateStudentId();
            // console.log(sid);            
        }

        await conn.query('BEGIN')

        const userResult = await conn.query(`
            INSERT INTO users(email, password, role, status) 
            VALUES ($1, $2, $3, $4) RETURNING uid`, 
            [email, password, role, status])

        const newUserId = userResult.rows[0].uid

        await conn.query(`
            INSERT INTO users_info(uid, fname, mname, lname, course, phone,student_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`, 
            [newUserId, fname,mname,lname,course,phone, sid])

        await conn.query('COMMIT')
    } catch (err) {
        await conn.query('ROLLBACK')
        throw err        
    } finally {
        conn.release()
    }
}

async function generateStudentId(){    
    const year = new Date().getFullYear()
    let result
    try {
        result = await pool.query(
        `
        SELECT student_id
        FROM users_info
        WHERE student_id >= $1 and student_id < $2
        ORDER BY student_id DESC
        LIMIT 1
        `,
        [year * 10000, (year + 1) * 10000]
    )
    } catch (error) {
        console.log(error)        
    }

    let sequence = 1

    if (result.rows.length > 0) {
        const lastStudentId = result.rows[0].student_id
        sequence = (lastStudentId % 10000) + 1
    }

    return year * 10000 + sequence;
}

export async function loginUser(user){    
    const result = await pool.query('SELECT * from public.users WHERE email = $1',[user])
    return result.rows
}

export async function getUserById(uid){    
    const result = await pool.query(`SELECT * FROM users_info ui JOIN users u ON u.uid=ui.uid WHERE u.uid = $1`,[uid])    
    return result.rows
}

export default pool