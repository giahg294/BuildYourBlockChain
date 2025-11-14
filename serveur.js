#!/usr/bin/env node

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { Server } from 'socket.io'
import { io as ioClient } from 'socket.io-client'

// Analyse des paramètres
const argv = yargs(hideBin(process.argv))
  .option('port', {
    alias: 'p',
    default: '3000',
    description: 'port à utiliser'
  })
  .version('1.0.0')
  .help()
  .argv

// Création de la DB
const db = Object.create(null)

const neighbors = [];

const sockets = [];

// Envoyer les clefs/valeurs existantes au nouveau peer
function sync(peerSocket) {
  for (const [field, entry] of Object.entries(db)) {
    try {
      peerSocket.emit('set', field, entry.value, (err) => {
        if (err) console.warn('Error sending existing key to peer:', err)
      })
    } catch (e) {
      console.warn('Failed to send existing key to peer:', e.message || e)
    }
  }
}

// Initialisation d'une socket
function initSocket (socket) {
  socket.on('get', function (field, callback) {
    if (field in db) {
      console.info(`get ${field}: ${db[field]?.value}`)
      callback(undefined, db[field]) // lit et renvoie la valeur associée à la clef.
    } else {
      const error = new Error(`Field ${field} not exists`)
      console.error(error)
      callback(error.message)
    }
  })

  socket.on('set', function (field, value, callback) {
    const isNew = !(field in db)

    if (field in db && db[field].value != value) { // Si la clef est dans la base de donnée avec une autre valeur -> erreur
      const error = new Error(`set error : Field ${field} exists.`)
      console.info(error)
      callback(error.message)
    } else {
      console.info(`set ${field} : ${value}`)
      db[field] = {
        value,
        date: Date.now() // on sauvegarde la date de création / mise à jour
      }
      callback()

      // Propager la nouvelle clé aux peers uniquement si on vient de la créer (évite les boucles)
      if (isNew) {
        for (const s of sockets) {
          // ne pas renvoyer à l'émetteur
          if (s === socket) continue
          try {
            s.emit('set', field, value, (err) => {
              if (err) console.warn('Error forwarding set to peer:', err)
            })
          } catch (e) {
            console.warn('Failed to emit set to a peer socket:', e.message || e)
          }
        }
      }
    }
  })

  socket.on('keys', function (callback) {
    console.info('keys')
    callback(undefined, Object.keys(db)) // Object.keys() extrait la liste des clefs d'un object et les renvoie sous forme d'un tableau.
  })

  socket.on('peers', function (callback) {
    console.info('peers')
    callback(undefined, neighbors)
  })

  socket.on('addPeer', (peerPort, callback) => {
    if (neighbors.includes(peerPort)) {
      const error = new Error('neighbor exists')
      console.info(error)
      callback(error.message)
      return
    }

    console.info(`addPeer : ${peerPort}`)
    neighbors.push(peerPort)
    console.log('Neighbors:', neighbors)
    callback(undefined, neighbors)

    // Connect to the peer automatically
    const peerSocket = ioClient(`http://localhost:${peerPort}`, { path: '/byc' })

    // stocker la socket client dans la liste
    sockets.push(peerSocket)

    peerSocket.on('connect', () => {
      console.info(`Connected to peer on port ${peerPort}`)
      // Appliquer les handlers locaux sur la socket client (après connexion)
      initSocket(peerSocket)

      peerSocket.emit('auth', argv.port, (error, peerPortAck) => {
        if (error) {
          console.error('ERROR:', error)
        } else {
          console.info(`Peer on port ${peerPortAck} acknowledged connection`)
          sync(peerSocket)
        }
      })
    })
  })
    
  socket.on('auth', (peerPort, callback) => {
    if (neighbors.includes(peerPort)) {
      const error = new Error(`Port ${peerPort} exists.`)
      console.info(error)
      callback(error.message)
    } else {
      console.info(`Authenticated peer : ${peerPort}`)
      neighbors.push(peerPort)
      console.log('Neighbors:', neighbors)

      // stocker la socket entrante (serveur-side socket) et lui appliquer nos handlers
      if (!sockets.includes(socket)) {
        sockets.push(socket)
      }
      initSocket(socket)

      callback(undefined, argv.port)
    }
  })
}

// Création du serveur
const io = new Server(argv.port, {
  path:  '/byc',
  serveClient: false
})

console.info(`Serveur lancé sur le port ${argv.port}.`)

// À chaque nouvelle connexion
io.on('connect', (socket) => {
  console.info('Nouvelle connexion')
  initSocket(socket)
})
