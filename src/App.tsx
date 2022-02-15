import React from 'react'
import './App.css'
import { batchEffects, Dispatch, Effect, mapEffect, Program } from './program'
import { program } from './raj-program'

type Bottle = {
  id: string
  height: number
  fillMin: number
  fillMax: number
  fillRate: number // % per second
}

type GameScene = {
  type: 'game'
  gameId: number
  score: number
  fillStart: number | undefined
  holdEnd: number | undefined
  previousBottle: Bottle | undefined
  currentBottle: Bottle
  nextBottle: Bottle
}

type Scene = { type: 'loading' } | { type: 'about' } | GameScene

type Model = {
  touch: boolean
  scene: Scene
  highScore: number | undefined
  previousGame: GameScene | undefined
}

type Msg =
  | {
      type: 'load'
      initialScene: 'game' | 'about'
      highScore: number | undefined
    }
  | { type: 'navigate'; scene: 'about' | 'game' }
  | { type: 'start_fill' }
  | { type: 'end_fill' }
  | { type: 'animation_frame'; ms: number }
  | { type: 'reset_game' }

// NOTE: We accept the value so it easier to debug
// what caused the exhaustive check to fail in test.
class AbsurdError<A> extends TypeError {
  readonly value: A

  constructor(message: string, value: A) {
    super(message)

    this.value = value
  }
}

function absurd(value: never, message?: string): never {
  throw new AbsurdError(
    message || 'Unexpected value passed to `absurd`.',
    value
  )
}

const highScoreKey = 'high_score'

function getSavedHighScore(): number | undefined {
  const value = localStorage.getItem(highScoreKey)
  if (!value) {
    return
  }

  const int = parseInt(value, 10)
  if (!isFinite(int)) {
    return
  }

  return int
}

function setHighScore(highScore: number) {
  localStorage.setItem(highScoreKey, highScore.toString())
}

function oneOf<A>(list: A[]): A {
  const index = Math.floor(Math.random() * list.length)
  return list[index]!
}

function inRange(min: number, max: number): number {
  const size = max - min
  const val = size * Math.random()
  return min + val
}

const fillRates = [0.00085, 0.0009, 0.00095, 0.001, 0.0011, 0.0012]

function makeRandomBottle(score: number): Bottle {
  const newGameHandicap = Math.max(10 - score, 0)
  const fillMax = inRange(0.6, 0.95)
  const fillMin = inRange(fillMax - 0.2 - newGameHandicap * 0.01, fillMax - 0.1)

  return {
    id: `b${score}`,
    height: 0,
    fillMax,
    fillMin,
    fillRate: oneOf(fillRates),
  }
}

function makeInitialGame(gameId: number): GameScene {
  return {
    type: 'game',
    score: 0,
    gameId,
    previousBottle: undefined,
    currentBottle: makeRandomBottle(0),
    nextBottle: makeRandomBottle(1),
    fillStart: undefined,
    holdEnd: undefined,
  }
}

function followHashChanges() {
  let dispatch: (hash: string) => void
  function listener() {
    if (dispatch) {
      dispatch(window.location.hash)
    }
  }

  return {
    effect(fn: (hash: string) => void) {
      dispatch = fn
      window.addEventListener('hashchange', listener)
    },
    cancel() {
      window.removeEventListener('hashchange', listener)
    },
  }
}

function pollAnimationFrame() {
  let dispatch: undefined | Dispatch<number>
  function listener() {
    if (dispatch) {
      dispatch(Date.now())
      window.requestAnimationFrame(listener)
    }
  }

  return {
    effect(fn: Dispatch<number>) {
      dispatch = fn
      window.requestAnimationFrame(listener)
    },
    cancel() {
      dispatch = undefined
    },
  }
}

function watchSpaceKey() {
  let dispatch: undefined | Dispatch<boolean>
  function listener(e: KeyboardEvent) {
    if (dispatch && e.key === ' ') {
      dispatch(e.type === 'keydown')
    }
  }

  return {
    effect(fn: Dispatch<boolean>) {
      dispatch = fn
      window.addEventListener('keydown', listener)
      window.addEventListener('keyup', listener)
    },
    cancel() {
      dispatch = undefined
      window.removeEventListener('keydown', listener)
      window.removeEventListener('keyup', listener)
    },
  }
}

const hashChanges = followHashChanges()
const animationFrame = pollAnimationFrame()
const spaceKey = watchSpaceKey()

function getSceneFromHash(hash: string) {
  if (hash === '#about') {
    return 'about'
  }

  return 'game'
}

function loadInitialState(dispatch: Dispatch<Msg>) {
  const highScore = getSavedHighScore()
  const initialScene = window.location.hash === '#about' ? 'about' : 'game'
  dispatch({ type: 'load', initialScene, highScore })
}

const appProgram: Program<Msg, Model, React.ReactElement> = {
  init: [
    {
      touch: 'ontouchstart' in window,
      highScore: undefined,
      scene: { type: 'loading' },
      previousGame: undefined,
    },
    batchEffects([
      loadInitialState,
      mapEffect(hashChanges.effect, (hash) => {
        const scene = getSceneFromHash(hash)
        return { type: 'navigate', scene }
      }),
      mapEffect(spaceKey.effect, (isStart) =>
        isStart ? { type: 'start_fill' } : { type: 'end_fill' }
      ),
    ]),
  ],
  done() {
    spaceKey.cancel()
    hashChanges.cancel()
  },
  update(msg, model) {
    switch (msg.type) {
      case 'load': {
        let scene: Scene
        switch (msg.initialScene) {
          case 'about':
            scene = { type: 'about' }
            break
          case 'game':
            scene = makeInitialGame(0)
            break
          default:
            absurd(msg.initialScene)
        }

        const newModel: Model = { ...model, highScore: msg.highScore, scene }

        return [newModel]
      }
      case 'navigate': {
        switch (msg.scene) {
          case 'about':
            return [
              {
                ...model,
                scene: { type: 'about' },
              },
            ]
          case 'game':
            return [
              {
                ...model,
                scene: makeInitialGame(0),
              },
            ]
          default:
            absurd(msg.scene)
        }
        break
      }
      case 'start_fill': {
        const { scene } = model
        const game = scene.type === 'game' ? scene : undefined
        if (!game || game.fillStart) {
          return [model]
        }

        return [
          {
            ...model,
            scene: { ...game, fillStart: Date.now() },
          },
          mapEffect(animationFrame.effect, (ms) => ({
            type: 'animation_frame',
            ms,
          })),
        ]
      }
      case 'end_fill': {
        const { scene } = model
        const game = scene.type === 'game' ? scene : undefined
        if (!game || !game.fillStart) {
          return [model]
        }
        const { currentBottle, fillStart } = game
        const fillEnd = Date.now()
        const finalHeight = (fillEnd - fillStart!) * currentBottle.fillRate

        let failType
        if (finalHeight > currentBottle.fillMax) {
          failType = 'overflow' as const
        }

        if (finalHeight < currentBottle.fillMin) {
          failType = 'underflow' as const
        }

        if (failType) {
          let effect: Effect<Msg> = batchEffects([
            animationFrame.cancel,
            (d) => setTimeout(() => d({ type: 'reset_game' }), 500),
          ])

          return [
            {
              ...model,
              scene: { ...game, holdEnd: fillEnd },
            },
            effect,
          ]
        }

        const newScore = game.score + 1

        return [
          {
            ...model,
            scene: {
              ...game,
              score: newScore,
              fillStart: undefined,
              previousBottle: currentBottle,
              currentBottle: game.nextBottle,
              nextBottle: makeRandomBottle(1 + newScore),
            },
          },
          animationFrame.cancel,
        ]
      }
      case 'animation_frame': {
        const { scene } = model
        const game = scene.type === 'game' ? scene : undefined
        if (!game) {
          return [model]
        }

        const { currentBottle, fillStart } = game
        const updatedBottle = {
          ...currentBottle,
          height: (msg.ms - fillStart!) * currentBottle.fillRate,
        }

        return [{ ...model, scene: { ...game, currentBottle: updatedBottle } }]
      }
      case 'reset_game': {
        const { scene } = model
        const game = scene.type === 'game' ? scene : undefined
        if (!game) {
          return [model]
        }

        const highScore = game.score > (model.highScore || 0)
        const effect = highScore ? () => setHighScore(game.score) : undefined

        return [
          {
            ...model,
            highScore: highScore ? game.score : model.highScore,
            scene: makeInitialGame(game.gameId + 1),
            previousGame: game,
          },
          effect,
        ]
      }
      default:
        absurd(msg)
    }
  },
  view(model, dispatch) {
    const { scene } = model
    switch (scene.type) {
      case 'loading':
        return <div>Loading...</div>
      case 'about':
        return (
          <div key="about" className="About">
            <div className="About-info">
              <h1>Fill Line</h1>
              <p className="About-description">
                Fill cups up to their fill lines in rapid succession.
              </p>
              <p className="About-credits">
                Fill Line is written by{' '}
                <a href="https://jew.ski">Chris Andrejewski</a>.<br /> This game
                is{' '}
                <a href="https://github.com/andrejewski/fill-line">
                  open source
                </a>
                .
              </p>
            </div>

            <a className="About-back" href="#">
              <div className="About-back-wave">← Back to game</div>
            </a>
          </div>
        )
      case 'game': {
        return (
          <>
            <div
              key={`game-${scene.gameId}`}
              className="Game"
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                return false
              }}
              {...(scene.holdEnd
                ? {}
                : model.touch
                ? {
                    onTouchStart() {
                      if (scene.fillStart) {
                        dispatch({ type: 'end_fill' })
                      } else {
                        dispatch({ type: 'start_fill' })
                      }
                    },
                    onClick(e) {
                      e.preventDefault()
                    },
                  }
                : {
                    onMouseDown() {
                      dispatch({ type: 'start_fill' })
                    },
                    onMouseUp() {
                      dispatch({ type: 'end_fill' })
                    },
                  })}
            >
              <div className="Game-hud">
                <GameScore
                  {...{
                    type: 'previous',
                    score: model.previousGame?.score,
                  }}
                />

                {(model.previousGame || model.highScore) && (
                  <GameScore
                    {...{
                      key: `score-${scene.gameId}-${scene.score}`,
                      type: 'current',
                      score: scene.score,
                    }}
                  />
                )}

                {model.highScore && model.highScore > 0 && (
                  <GameScore
                    {...{
                      type: 'high',
                      score: model.highScore,
                    }}
                  />
                )}
              </div>

              {scene.previousBottle && (
                <BottleScene
                  key={scene.previousBottle.id}
                  type="previous"
                  bottle={scene.previousBottle}
                />
              )}

              <BottleScene
                key={scene.currentBottle.id}
                type="current"
                bottle={scene.currentBottle}
                pouring={!!(scene.fillStart && scene.fillStart > 0)}
              />
              <BottleScene
                key={scene.nextBottle.id}
                type="next"
                bottle={scene.nextBottle}
              />
            </div>
            {scene.score === 0 && (
              <a
                className="Game-about-link"
                title="About this game"
                href="#about"
              >
                ?
              </a>
            )}
          </>
        )
      }
      default:
        absurd(scene)
    }
  },
}

function GameScore({
  type,
  score,
}: {
  type: 'previous' | 'current' | 'high' | 'next'
  score: number | undefined
}) {
  return (
    <div className={`Game-score Game-score--${type}`}>
      <span>{score !== undefined ? score : ''}</span>
    </div>
  )
}

function pc(x: number) {
  return `${x * 100}%`
}

function BottleScene({
  type,
  bottle,
  pouring,
}: {
  type: 'side' | 'previous' | 'next' | 'current'
  bottle: Bottle
  pouring?: boolean
}) {
  return (
    <div id={bottle.id} className={`Bottle Bottle--${type}`}>
      <div className="cup-outer">
        <div className="cup-inner">
          <div
            className="cup-fill-line"
            style={{
              bottom: pc(bottle.fillMin),
              height: pc(bottle.fillMax - bottle.fillMin - 0.01),
            }}
          ></div>
          <div className="cup-water-well">
            <div
              className="cup-water"
              style={{ height: pc(bottle.height) }}
            ></div>
          </div>

          {pouring && <div className="cup-water-pour"></div>}
        </div>
      </div>
    </div>
  )
}

export const App = program(React.Component, () => appProgram)
