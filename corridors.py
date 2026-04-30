import random, time


def corridors():
    credits = 0
    print("\nWelcome to the Corridor Door Luck Game!")
    print("You must choose the correct door in each corridor to keep moving forward.")
    print("You get 10 credits for each correct door.")
    print("One wrong door will kick you out of the game.")
    print("As you progress, the corridor gets harder with more trapped doors.\n")

    max_corridors = 6
    base_doors = 3
    base_credits = 10

    for corridor in range(1, max_corridors + 1):
        num_doors = base_doors + corridor - 1
        safe_door = random.randint(1, num_doors)
        trapped_doors = num_doors - 1
        available_credits = base_credits * corridor

        print(f"Corridor {corridor}: {num_doors} doors stand before you.")
        print(f"Only one door leads onward. {trapped_doors} door(s) will kick you out.")
        print(f"There are {available_credits} credits available in this corridor.\n")

        while True:
            print("Choosing `e` will allow you to escape unscathed with your hard-earned credits")
            choice = input(f"Choose a door number between 1 and {num_doors}: ").strip()
            if choice == "e":
                print("You smash the window, jump out and run.")
                print(f"You got away with {credits} credits")
                time.sleep(2)
                return credits
            
            if not choice.isdigit():
                print("Please enter a number.")
                continue
            choice = int(choice)
            if 1 <= choice <= num_doors:
                break
            print(f"Invalid choice. Pick a door from 1 to {num_doors}.")

        if choice == safe_door:
            print("You chose the right door and continue deeper into the corridor!\n")
            print(f"You found {available_credits} credits!")
            credits += available_credits
        else:
            print(f"Door {choice} was trapped. The corridor kicks you out!")
            print(f"The safe door was number {safe_door}.")
            print("Game over. Better luck next time!\n")
            credits = 0
            return credits

    print("Congratulations! You found the correct door through every corridor.")
    print("You survived the corridor luck challenge!\n")
    return credits



