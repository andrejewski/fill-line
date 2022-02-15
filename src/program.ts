export type Dispatch<Msg> = {
  (value: Msg): void
}

export type Effect<Msg> = {
  (dispatch: Dispatch<Msg>): void
}

export type Program<Msg, Model, View> = {
  init: [Model] | [Model, Effect<Msg> | undefined]
  update(msg: Msg, model: Model): [Model] | [Model, Effect<Msg> | undefined]
  view(model: Model, dispatch: Dispatch<Msg>): View
  done?(): void
}

export function mapEffect<A, B>(
  effect: Effect<A> | undefined,
  callback: (value: A) => B
): Effect<B> | undefined {
  if (!effect) {
    return effect
  }

  return function _mapEffect(dispatch) {
    return effect((message) => {
      dispatch(callback(message))
    })
  }
}

export function batchEffects<Msg>(
  effects: (Effect<Msg> | undefined)[]
): Effect<Msg> {
  return function _batchEffects(dispatch) {
    return effects.map((effect) => {
      return effect ? effect(dispatch) : undefined
    })
  }
}
